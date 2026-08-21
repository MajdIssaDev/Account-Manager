import { cookieHeader } from "./store";

export type RobloxUser = {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string;
};

function normalizeCookie(input: string): string {
  let c = input.trim();
  c = c.replace(/^Cookie:\s*/i, "");
  const m = c.match(/\.ROBLOSECURITY=([^;]+)/i);
  if (m) {
    return m[1].trim();
  }
  return c.replace(/^["']|["']$/g, "").trim();
}

async function robloxFetch(
  url: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookieHeader(cookie));
  headers.set("User-Agent", CHROME_UA);
  headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers });
}

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchAuthenticatedUser(cookieRaw: string): Promise<RobloxUser> {
  const cookie = normalizeCookie(cookieRaw);
  if (!cookie) {
    throw new Error("Cookie is empty.");
  }
  const res = await robloxFetch("https://users.roblox.com/v1/users/authenticated", cookie);
  if (res.status === 401) {
    throw new Error("Session is invalid or expired.");
  }
  if (!res.ok) {
    throw new Error(`Could not read user (${res.status}).`);
  }
  const body = (await res.json()) as {
    id?: number;
    name?: string;
    displayName?: string;
  };
  if (!body.id || !body.name) {
    throw new Error("Unexpected user payload.");
  }
  const avatarUrl = await fetchAvatar(body.id);
  return {
    userId: body.id,
    username: body.name,
    displayName: body.displayName || body.name,
    avatarUrl,
  };
}

async function fetchAvatar(userId: number): Promise<string> {
  try {
    const url =
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}` +
      `&size=150x150&format=Png&isCircular=true`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return "";
    }
    const json = (await res.json()) as {
      data?: { imageUrl?: string }[];
    };
    return json.data?.[0]?.imageUrl || "";
  } catch {
    return "";
  }
}

async function getCsrf(cookie: string): Promise<string> {
  const res = await robloxFetch("https://auth.roblox.com/v1/authentication-ticket", cookie, {
    method: "POST",
    headers: {
      Origin: "https://www.roblox.com",
      Referer: "https://www.roblox.com/",
      "Content-Type": "application/json",
      rbxauthenticationnegotiation: "1",
    },
    body: "{}",
  });
  const token = res.headers.get("x-csrf-token");
  if (!token) {
    throw new Error("Could not get CSRF token. Session may be invalid.");
  }
  return token;
}

export async function createAuthenticationTicket(cookieRaw: string): Promise<string> {
  const cookie = normalizeCookie(cookieRaw);
  const csrf = await getCsrf(cookie);
  const headers = {
    "x-csrf-token": csrf,
    rbxauthenticationnegotiation: "1",
    Origin: "https://www.roblox.com",
    Referer: "https://www.roblox.com/",
    "Content-Type": "application/json",
  };
  let res = await robloxFetch("https://auth.roblox.com/v1/authentication-ticket", cookie, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (res.status === 403) {
    const retryToken = res.headers.get("x-csrf-token");
    if (retryToken) {
      res = await robloxFetch("https://auth.roblox.com/v1/authentication-ticket", cookie, {
        method: "POST",
        headers: { ...headers, "x-csrf-token": retryToken },
        body: "{}",
      });
    }
  }
  if (!res.ok) {
    throw new Error(`Authentication ticket failed (${res.status}).`);
  }
  const ticket =
    res.headers.get("rbx-authentication-ticket") ||
    res.headers.get("RBX-Authentication-Ticket");
  if (!ticket) {
    throw new Error("Roblox did not return an authentication ticket.");
  }
  return ticket;
}

export { normalizeCookie };
