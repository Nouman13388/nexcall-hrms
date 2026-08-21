import { httpRouter } from "convex/server"; 
import { authComponent, createAuth } from "./auth"; 
import { events, interactions } from "./slack";

const http = httpRouter(); 
authComponent.registerRoutes(http, createAuth); 

http.route({
  path: "/slack/events",
  method: "POST",
  handler: events,
});

http.route({
  path: "/slack/interactions",
  method: "POST",
  handler: interactions,
});

export default http;
