import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, vi, expect, beforeEach } from "vitest";

// Mock RenderNodes
vi.mock("@/app/dashboard/renderNodes", () => ({
    RenderNodes: ({ org }: { org: string }) => (
        <div data-testid="render-nodes">Rendering nodes for: {org}</div>
    ),
}));

// Mock next/navigation's useSearchParams
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
    useSearchParams: () => mockSearchParams,
}));

// Import after mocks
import Dashboard from "@/app/dashboard/page";

describe("Dashboard", () => {
    beforeEach(() => {
        // Reset search params and mocks
        mockSearchParams.delete("org");
        vi.resetAllMocks();

        // Mock global redirect
        delete (window as any).location;
        (window as any).location = { href: "/" };
        document.cookie = "session_visible=visible";
    });

    it("renders fallback when no org is in search params", () => {
        render(<Dashboard />);
        expect(screen.getByText("Select an Org")).toBeInTheDocument();
    });

    it("renders RenderNodes component when org is present", () => {
        mockSearchParams.set("org", "TestOrg");

        render(<Dashboard />);
        expect(screen.getByTestId("render-nodes")).toHaveTextContent("Rendering nodes for: TestOrg");
    });

    it("logs out and clears session cookie", () => {
        render(<Dashboard />);

        const logoutBtn = screen.getByText("Log out");
        fireEvent.click(logoutBtn);

        expect(document.cookie).toContain("");
        expect(window.location.href).toBe("/");
    });
});
