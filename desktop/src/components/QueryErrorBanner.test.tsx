import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QueryErrorBanner from "./QueryErrorBanner";

describe("QueryErrorBanner", () => {
  it("supports error, retrying, and recovered states", () => {
    const onRetry = vi.fn();
    const view = render(<QueryErrorBanner error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    view.rerender(
      <QueryErrorBanner
        error={new Error("private detail")}
        message="Couldn't refresh standings."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't refresh standings.",
    );
    expect(screen.queryByText("private detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    view.rerender(
      <QueryErrorBanner
        error={new Error("private detail")}
        onRetry={onRetry}
        retrying
      />,
    );
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();

    view.rerender(<QueryErrorBanner error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
