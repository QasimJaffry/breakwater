import { describe, expect, it } from "vitest";
import { routeKey } from "@breakwater/core";

describe("routeKey", () => {
  it("strips host, query and trailing slash; uppercases method", () => {
    expect(routeKey("get", "https://api.x.com/v1/me/?token=abc")).toBe("GET /v1/me");
  });
  it("replaces ids with :id (numeric, uuid, hex, opaque)", () => {
    expect(routeKey("GET", "/orders/123/items")).toBe("GET /orders/:id/items");
    expect(routeKey("GET", "/u/3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b")).toBe("GET /u/:id");
    expect(routeKey("GET", "/c/5f1a9c3e2b7d4a60")).toBe("GET /c/:id");
    expect(routeKey("GET", "/s/cus_Na6dX7aXxi11N4abcd")).toBe("GET /s/:id");
  });
  it("keeps readable words", () => {
    expect(routeKey("GET", "/restaurants/nearby")).toBe("GET /restaurants/nearby");
  });
  it("explicit patterns win, with optional method", () => {
    expect(routeKey("GET", "/users/qasim/profile", ["/users/:handle/profile"])).toBe("GET /users/:handle/profile");
    expect(routeKey("POST", "/users/qasim", [{ method: "GET", pattern: "/users/:handle" }])).toBe("POST /users/qasim");
  });
});
