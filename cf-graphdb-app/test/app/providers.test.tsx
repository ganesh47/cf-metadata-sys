import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Import the actual component
import Providers from "@/app/providers";

// Mock @heroui/react and @heroui/toast
vi.mock("@heroui/react", () => ({
    HeroUIProvider: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="heroui-provider">{children}</div>
    ),
}));

vi.mock("@heroui/toast", () => ({
    ToastProvider: ({ placement, toastOffset }: { placement: string; toastOffset: number }) => (
        <div data-testid="toast-provider" data-placement={placement} data-offset={toastOffset}></div>
    ),
}));

describe("Providers component", () => {
    it("wraps children with HeroUIProvider and ToastProvider", () => {
        render(
            <Providers>
                <div data-testid="child">Hello</div>
            </Providers>
        );

        expect(screen.getByTestId("heroui-provider")).toBeInTheDocument();
        expect(screen.getByTestId("toast-provider")).toBeInTheDocument();
        expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-placement", "top-center");
        expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-offset", "100");
        expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });
});
