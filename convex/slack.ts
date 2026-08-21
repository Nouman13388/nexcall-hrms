import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
  
  if (!signature.startsWith("v0=")) return false;
  const supplied = signature.slice(3);
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const bytes = new Uint8Array(
    supplied.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(sigBaseString));
};

export const events = httpAction(async (_ctx, request) => {
  const isValid = await verifySlackSignature(request);
  if (!isValid) return new Response("Unauthorized", { status: 401 });

  const body: unknown = await request.json();
  if (!isRecord(body) || typeof body.type !== "string") {
    return new Response("Bad Request", { status: 400 });
  }

  if (body.type === "url_verification") {
    if (typeof body.challenge !== "string") {
      return new Response("Bad Request", { status: 400 });
    }
    return new Response(body.challenge, { status: 200 });
  }

  if (body.type === "event_callback" && isRecord(body.event)) {
    const event = body.event;
    if (event.type === "app_home_opened" && typeof event.user === "string") {
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

export const interactions = httpAction(async (ctx, request) => {
  const isValid = await verifySlackSignature(request);
  if (!isValid) return new Response("Unauthorized", { status: 401 });

  const text = await request.text();
  const params = new URLSearchParams(text);
  const payloadStr = params.get("payload");
  if (!payloadStr) return new Response("Bad Request", { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (isRecord(payload) && payload.type === "block_actions") {
    const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
    const user = payload.user;
    if (!isRecord(action) || !isRecord(user) || typeof user.id !== "string") {
      return new Response("Bad Request", { status: 400 });
    }
    const slackUserId = user.id;
    const eventType = action.value;
    if (eventType !== "CHECK_IN" && eventType !== "CHECK_OUT") {
      return new Response("Unsupported action", { status: 400 });
    }

    let employeeId = null;
    let employee = await ctx.runQuery(internal.employees.getBySlackId, { slackUserId });
    let slackEmail: string | undefined;

    if (!employee) {
      slackEmail = await getSlackUserEmail(slackUserId);
      if (slackEmail) {
        employee = await ctx.runQuery(internal.employees.getByEmail, { email: slackEmail });
        if (employee) {
          await ctx.runMutation(internal.employees.updateSlackId, { id: employee._id, slackUserId });
          employeeId = employee._id;
        }
      }
    } else {
      employeeId = employee._id;
    }

    const rawSlackUserId = slackUserId;
    const rawSlackEmail = employee?.email ?? slackEmail;

    await ctx.runMutation(internal.attendance.recordEvent, {
      employeeId: employeeId ?? undefined,
      eventType,
      source: "SLACK",
      occurredAt: Date.now(),
      rawSlackUserId,
      rawSlackEmail,
    });

    if (!employeeId) {
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
  if (!res.ok) return undefined;
  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.user) || !isRecord(data.user.profile)) {
    return undefined;
  }
  return typeof data.user.profile.email === "string"
    ? data.user.profile.email
    : undefined;
}

async function sendEphemeralMessage(slackUserId: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
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
