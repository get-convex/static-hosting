import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api.js";

export const Route = createFileRoute("/")({
  // Runs on the server for the first request.
  loader: () => ({ renderedAt: new Date().toISOString().slice(11, 19) }),
  component: Home,
});

function Home() {
  const { renderedAt } = Route.useLoaderData();
  // Fetched during the server render, then kept live in the browser.
  const { data: count } = useSuspenseQuery(convexQuery(api.counter.get, {}));
  const increment = useConvexMutation(api.counter.increment);
  return (
    <main>
      <h1>TanStack Start on Convex</h1>
      <p>
        Rendered in a Convex HTTP action at {renderedAt} UTC. View the page
        source to see the HTML the server sent.
      </p>
      <div className="counter">
        <span className="count">{count}</span>
        <button type="button" onClick={() => void increment({})}>
          Add a click
        </button>
      </div>
      <p>
        The count lives in Convex. Open this page in two tabs: a click in one
        updates both.
      </p>
    </main>
  );
}
