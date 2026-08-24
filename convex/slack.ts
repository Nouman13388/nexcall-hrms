import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

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

export const events = httpAction(async (ctx, request) => {
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
      const { employee } = await resolveEmployee(ctx, event.user);
      await publishAppHome(ctx, event.user, employee);
    }
  }

  return new Response("OK", { status: 200 });
});

// Same resolution flow used by the check-in/check-out interaction:
// slackUserId → by_slackUserId, falling back to a users.info email lookup
// → by_email (caching the slackUserId on match). Shared here so the Home
// tab and the button handler never drift out of sync.
async function resolveEmployee(
  ctx: ActionCtx,
  slackUserId: string,
): Promise<{ employee: Doc<"employees"> | null; slackEmail?: string }> {
  const cached = await ctx.runQuery(internal.employees.getBySlackId, { slackUserId });
  if (cached) return { employee: cached };

  const slackEmail = await getSlackUserEmail(slackUserId);
  if (!slackEmail) return { employee: null };

  const employee = await ctx.runQuery(internal.employees.getByEmail, { email: slackEmail });
  if (employee) {
    await ctx.runMutation(internal.employees.updateSlackId, { id: employee._id, slackUserId });
  }
  return { employee, slackEmail };
}

async function publishAppHome(
  ctx: ActionCtx,
  slackUserId: string,
  employee: Doc<"employees"> | null,
) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  const view = employee
    ? await buildResolvedHomeView(ctx, employee)
    : buildUnmatchedHomeView();

  await fetch("https://slack.com/api/views.publish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: slackUserId, view }),
  });
}

function buildUnmatchedHomeView() {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Nexcall HRMS" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "You're not recognized as an employee yet. Please contact HR to get set up.",
        },
      },
    ],
  };
}

async function buildResolvedHomeView(ctx: ActionCtx, employee: Doc<"employees">) {
  const today = await ctx.runQuery(internal.attendance.getToday, { employeeId: employee._id });

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Nexcall HRMS" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `Welcome, *${employee.fullName}*` },
    },
  ];

  const checkedIn = Boolean(today?.checkInAt);
  const checkedOut = Boolean(today?.checkOutAt);

  if (checkedOut) {
    const checkIn = today?.checkInAt ? formatTime(today.checkInAt) : "—";
    const checkOut = today?.checkOutAt ? formatTime(today.checkOutAt) : "—";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *Today's status: Complete*\nChecked in ${checkIn} · Checked out ${checkOut}`,
      },
    });
  } else if (checkedIn) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:large_green_circle: *Today's status: Checked in* at ${formatTime(today!.checkInAt!)}`,
      },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Check Out" },
          style: "danger",
          value: "CHECK_OUT",
          action_id: "check_out_action",
        },
      ],
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Today's status:* Not checked in yet" },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Check In" },
          style: "primary",
          value: "CHECK_IN",
          action_id: "check_in_action",
        },
      ],
    });
  }

  return { type: "home", blocks };
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
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

    const { employee, slackEmail } = await resolveEmployee(ctx, slackUserId);
    const employeeId = employee?._id ?? null;

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

    // Refresh the Home tab immediately so the button state (and today's
    // status) reflects the write we just made, without waiting on the
    // user to close/reopen the tab.
    await publishAppHome(ctx, slackUserId, employee);
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
