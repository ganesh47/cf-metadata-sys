import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("./globals.css", () => ({}));
// Mock before import
vi.mock("./providers", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="providers-wrapper">{children}</div>
    ),
}));
vi.mock("next/font/google", () => ({
    Geist: () => ({ variable: "mock-geist-sans" }),
    Geist_Mono: () => ({ variable: "mock-geist-mono" }),
}));


import RootLayoutInner from "@/app/layout";

describe("RootLayoutInner", () => {
    it("wraps children with Providers and font classes", () => {
        render(
            <RootLayoutInner>
                <div data-testid="child">Hello</div>
            </RootLayoutInner>
        );

        expect(screen.getByTestId("child")).toHaveTextContent("Hello");

    });
});
