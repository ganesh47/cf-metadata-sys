import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "@/app/page"; // adjust based on your structure

// Mock push router
const mockPush = vi.fn();

// Mock next/navigation before importing the component
vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: mockPush,
    }),
}));

// Mock addToast from @heroui/react
vi.mock("@heroui/react", async () => {
    const actual = await vi.importActual("@heroui/react");
    return {
        ...actual,
        addToast: vi.fn(),
    };
});

describe("Home component", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockPush.mockReset();
        global.fetch = vi.fn();
    });

    it("renders login button when fetch fails", async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
        });

        render(<Home />);
        expect(await screen.findByTestId("login-button")).toBeInTheDocument();
    });

    it("renders org dropdown when fetch succeeds", async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                orgs: ["Org A", "Org B"],
            }),
        });

        render(<Home />);
        expect(await screen.findByTestId("org-select")).toBeInTheDocument();
        expect(await screen.findByText("Org A")).toBeInTheDocument();
        expect(await screen.findByText("Org B")).toBeInTheDocument();
    });

    it("calls router.push when org is selected", async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                orgs: ["Org A"],
            }),
        });

        render(<Home />);
        let option = await screen.findByTestId('org-select');
        fireEvent.click(option);
        option = await screen.findByTestId('org-option-Org A');
        fireEvent.click(option);

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith("/dashboard?org=Org%20A");
        });
    });

    it("calls addToast when fetch throws error", async () => {
        const { addToast } = await import("@heroui/react");

        (global.fetch as any).mockRejectedValue(new Error("fail"));

        render(<Home />);
        await waitFor(() => {
            expect(addToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: expect.any(String),
                    color: "danger",
                })
            );
        });
    });
});
