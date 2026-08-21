import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const verifySlackSignature = async (request: Request) => {
  const clonedReq = request.clone();
  const signature = request.headers.get("X-Slack-Signature");
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  if (!signature || !timestamp) return false;

  // Protect against replay attacks (reject > 5 mins)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 60 * 5) return false;

  const body = await clonedReq.text();
  const sigBaseString = `v0:${timestamp}:${body}`;
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBaseString));
  const hexMac = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expectedSig = `v0=${hexMac}`;

  // Timing safe equal in crypto API is not natively available in browser Web Crypto without subtle,
  // but a string compare is mostly sufficient for this phase or we can use timingSafeEqual if in Node.
  // In Convex (V8 isolate), we just do a string comparison.
  return expectedSig === signature;
};

// Handle Slack URL verification and other events
export const events = httpAction(async (ctx, request) => {
  const isValid = await verifySlackSignature(request);
  if (!isValid) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();

  if (body.type === "url_verification") {
    return new Response(body.challenge, { status: 200 });
  }

  if (body.type === "event_callback") {
    const event = body.event;
    if (event.type === "app_home_opened") {
      // Publish the App Home view
      await publishAppHome(event.user);
    }
  }

  return new Response("OK", { status: 200 });
});

async function publishAppHome(slackUserId: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  const view = {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Nexcall HRMS" },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Check In" },
            style: "primary",
            value: "CHECK_IN",
            action_id: "check_in_action",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Check Out" },
            style: "danger",
            value: "CHECK_OUT",
            action_id: "check_out_action",
          },
        ],
      },
    ],
  };

  await fetch("https://slack.com/api/views.publish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: slackUserId, view }),
  });
}

// Handle Interactions (Button clicks)
export const interactions = httpAction(async (ctx, request) => {
  const isValid = await verifySlackSignature(request);
  if (!isValid) return new Response("Unauthorized", { status: 401 });

  const text = await request.text();
  const params = new URLSearchParams(text);
  const payloadStr = params.get("payload");
  if (!payloadStr) return new Response("Bad Request", { status: 400 });

  const payload = JSON.parse(payloadStr);

  if (payload.type === "block_actions") {
    const action = payload.actions[0];
    const slackUserId = payload.user.id;
    const eventType = action.value; // "CHECK_IN" or "CHECK_OUT"

    // Employee resolution flow
    // 1. Match by slackUserId
    let employeeId = null;
    let employee = await ctx.runQuery(api.employees.getBySlackId, { slackUserId });

    if (!employee) {
      // 2. Fetch email from Slack and match by email
      const email = await getSlackUserEmail(slackUserId);
      if (email) {
        employee = await ctx.runQuery(api.employees.getByEmail, { email });
        if (employee) {
          // Cache slackUserId
          await ctx.runMutation(api.employees.updateSlackId, { id: employee._id, slackUserId });
          employeeId = employee._id;
        }
      }
    } else {
      employeeId = employee._id;
    }

    const rawSlackUserId = slackUserId;
    const rawSlackEmail = employee ? employee.email : (await getSlackUserEmail(slackUserId));

    // Record the event
    await ctx.runMutation(api.attendance.recordEvent, {
      employeeId: employeeId ?? undefined,
      eventType: eventType as "CHECK_IN" | "CHECK_OUT",
      source: "SLACK",
      occurredAt: Date.now(),
      rawSlackUserId,
      rawSlackEmail,
    });

    if (!employeeId) {
      // 3. No match at all
      await sendEphemeralMessage(slackUserId, "User not recognized. Please contact HR.");
    } else {
      await sendEphemeralMessage(slackUserId, `Successfully recorded ${eventType.replace("_", " ")}`);
    }
  }

  return new Response("OK", { status: 200 });
});

async function getSlackUserEmail(slackUserId: string): Promise<string | undefined> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return undefined;
  
  const res = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data?.user?.profile?.email;
}

async function sendEphemeralMessage(slackUserId: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  // To send an ephemeral message, we typically need a channel ID.
  // In App Home, we can send a DM.
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: slackUserId,
      text,
    }),
  });
}
