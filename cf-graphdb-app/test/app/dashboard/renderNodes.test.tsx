import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {RenderNodes} from "@/app/dashboard/renderNodes"; // adjust path if needed

describe("RenderNodes", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        global.fetch = vi.fn();
    });

    it("renders loading state initially", () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ nodes: [] }) });

        render(<RenderNodes org="test-org" />);
        expect(screen.getByText("Loading nodes...")).toBeInTheDocument();
    });

    it("renders node list when fetch succeeds", async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                nodes: [
                    {
                        id: "node-1",
                        type: "Person",
                        properties: {
                            name: "Alice",
                            age: 30,
                        },
                    },
                ],
            }),
        });

        render(<RenderNodes org="test-org" />);

        expect(await screen.findByText("Nodes for test-org")).toBeInTheDocument();
        expect(screen.getByText("Node ID: node-1")).toBeInTheDocument();
        expect(screen.getByText("Type: Person")).toBeInTheDocument();
        expect(screen.getByTestId("Alice")).toBeInTheDocument();
        expect(screen.getByTestId("30")).toBeInTheDocument();
    });

    it("renders empty message when no nodes are found", async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ nodes: [] }),
        });

        render(<RenderNodes org="empty-org" />);
        expect(await screen.findByText("No nodes found.")).toBeInTheDocument();
    });

    it("renders error fallback when fetch fails", async () => {
        (global.fetch as any).mockRejectedValue(new Error("Network error"));

        render(<RenderNodes org="error-org" />);
        expect(await screen.findByText("No nodes found.")).toBeInTheDocument();
    });
});
