import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const get = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query("counter").first())?.count ?? 0,
});

export const increment = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const counter = await ctx.db.query("counter").first();
    if (counter) {
      await ctx.db.patch("counter", counter._id, { count: counter.count + 1 });
    } else {
      await ctx.db.insert("counter", { count: 1 });
    }
    return null;
  },
});
