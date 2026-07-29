import { render } from "@testing-library/react";
import { vi } from "vitest";
import RouteTransition from "./RouteTransition";
import type { PropsWithChildren } from "react";

vi.mock("motion/react", () => ({
  motion: {
    div: ({
      initial,
      children,
      className,
      transition,
      animate,
    }: PropsWithChildren<{
      initial: false | { opacity: number; transform: string };
      className?: string;
      transition: object;
      animate: { opacity: number; transform: string };
    }>) => (
      <div
        data-initial={JSON.stringify(initial)}
        data-transition={JSON.stringify(transition)}
        data-animate={JSON.stringify(animate)}
        className={className}
      >
        {children}
      </div>
    ),
  },
}));

test("only enters after the first route", () => {
  const view = render(
    <RouteTransition routeKey="/feed">Feed</RouteTransition>,
  );
  expect(view.getByText("Feed")).toHaveAttribute("data-initial", "false");

  view.rerender(
    <RouteTransition routeKey="/catalog">Catalog</RouteTransition>,
  );
  expect(view.getByText("Catalog")).toHaveAttribute(
    "data-initial",
    '{"opacity":0,"transform":"translateY(14px)"}',
  );
  expect(view.getByText("Catalog")).toHaveAttribute(
    "data-transition",
    '{"opacity":{"duration":0.42,"ease":[0.4,0,0.2,1]},"transform":{"type":"spring","bounce":0,"visualDuration":0.55}}',
  );
  expect(view.getByText("Catalog")).toHaveAttribute(
    "data-animate",
    '{"opacity":1,"transform":"translateY(0px)"}',
  );
});
