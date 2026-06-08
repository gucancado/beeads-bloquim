import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("vitest + RTL infra sanity", () => {
  it("renders a component and matches jest-dom", () => {
    render(<button type="button">click me</button>);
    const btn = screen.getByRole("button", { name: "click me" });
    expect(btn).toBeInTheDocument();
  });
});
