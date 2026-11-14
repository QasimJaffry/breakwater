// A small food-delivery API, before and after a "cleanup" PR.
export const specV1 = {
  openapi: "3.1.0",
  info: { title: "Eats", version: "1" },
  paths: {
    "/orders/{orderId}": {
      get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } } },
    },
    "/restaurants": {
      get: { responses: { "200": { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Restaurant" } } } } } } },
    },
    "/promos/legacy": {
      get: { responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { code: { type: "string" } } } } } } } },
    },
  },
  components: {
    schemas: {
      Order: {
        type: "object",
        required: ["id", "status", "eta", "courier", "items"],
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          eta: { type: "integer" },
          courier: { $ref: "#/components/schemas/Courier" },
          items: { type: "array", items: { type: "object", required: ["name", "price"], properties: { name: { type: "string" }, price: { type: "integer" } } } },
          legacyTip: { type: "number" },
        },
      },
      Courier: { type: "object", required: ["name", "phone"], properties: { name: { type: "string" }, phone: { type: "string" }, vehicle: { type: "string" } } },
      Restaurant: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" }, rating: { type: "number" }, parent: { $ref: "#/components/schemas/Restaurant" } } },
    },
  },
};

export const specV2 = JSON.parse(JSON.stringify(specV1));
// 1) courier.phone removed (privacy: masked calling instead)
delete specV2.components.schemas.Courier.properties.phone;
specV2.components.schemas.Courier.required = ["name"];
// 2) eta becomes a string ("12-18 min")
specV2.components.schemas.Order.properties.eta = { type: "string" };
// 3) rating may now be null
specV2.components.schemas.Restaurant.properties.rating = { type: ["number", "null"] };
// 4) legacyTip removed, 5) legacy promos endpoint removed (nobody reads either)
delete specV2.components.schemas.Order.properties.legacyTip;
delete specV2.paths["/promos/legacy"];

export const snapshot = {
  schema: 1 as const,
  generatedAt: "2026-11-14T00:00:00.000Z",
  windowDays: 30,
  versions: [
    { platform: "android", version: "4.4.0", installs: 900 },
    { platform: "android", version: "5.0.0", installs: 4100 },
    { platform: "ios", version: "4.2.0", installs: 300 },
    { platform: "ios", version: "4.3.1", installs: 700 },
    { platform: "ios", version: "5.0.0", installs: 4000 },
  ],
  usage: {
    "GET /orders/:id": {
      courier: ["android@4.4.0", "android@5.0.0", "ios@4.2.0", "ios@4.3.1", "ios@5.0.0"],
      "courier.name": ["android@4.4.0", "android@5.0.0", "ios@4.2.0", "ios@4.3.1", "ios@5.0.0"],
      "courier.phone": ["android@4.4.0", "ios@4.2.0", "ios@4.3.1"],
      eta: ["android@5.0.0", "ios@5.0.0"],
      items: ["android@5.0.0", "ios@5.0.0"],
      "items[]": ["android@5.0.0", "ios@5.0.0"],
      "items[].price": ["android@5.0.0", "ios@5.0.0"],
    },
    "GET /restaurants": { "[]": ["ios@5.0.0"], "[].name": ["ios@5.0.0"] },
  },
};
