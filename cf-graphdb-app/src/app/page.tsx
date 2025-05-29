"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {addToast, Button, Select, SelectItem} from "@heroui/react";

export default function Home() {
    const router = useRouter();
    const [orgs, setOrgs] = useState<string[]>([]);
    const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

    useEffect(() => {
        async function fetchOrgs() {
            try {
                console.log(`${process.env.NEXT_PUBLIC_OIDC_WORKER_BASE}/orgs`)
                const res = await fetch(`${process.env.NEXT_PUBLIC_OIDC_WORKER_BASE}/orgs`, {
                    credentials: "include",
                });
                if (!res.ok) { // noinspection ExceptionCaughtLocallyJS
                    throw new Error("Unauthorized");
                }
                const data: any = await res.json();
                const parsedOrgs = data.orgs || [];
                setOrgs(parsedOrgs);

            } catch (err) {
                console.error("Failed to fetch orgs:", err);
                addToast({
                    title: "Failed to load organizations",
                    description: "Please check your login or try again.",
                    color: "danger",
                    timeout: 3000,
                    shouldShowTimeoutProgress: true,
                });
            }
        }

        fetchOrgs();
    }, [router]);

    useEffect(() => {
        if (selectedOrg)
            router.push(`/dashboard?org=${encodeURIComponent(selectedOrg)}`);

    }, [selectedOrg])

    const handleLogin = async () => {
        try {
            const oidcDiscoveryUrl = process.env.NEXT_PUBLIC_OIDC_DISCOVERY_URL!;
            const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID!;
            const redirectUri = encodeURIComponent(process.env.NEXT_PUBLIC_OIDC_WORKER_BASE!);

            const config: any = await fetch(oidcDiscoveryUrl).then((res) => res.json());
            const authEndpoint = config.authorization_endpoint;

            window.location.href = `${authEndpoint}?response_type=code` +
                `&client_id=${clientId}` +
                `&redirect_uri=${redirectUri}/auth/callback` +
                `&scope=openid%20profile%20email`;
        } catch (err) {
            console.error("OIDC discovery failed", err);
        }
    };

    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
            <header className="w-full bg-white shadow px-6 py-4 flex items-center justify-between fixed top-0 z-50">
                {/* Left spacer */}
                <div className="w-1/3" />

                {/* Center logo */}
                <div className="w-1/3 flex justify-center">
                    <div className="bg-gradient-to-r from-purple-500 via-pink-500 to-fuchsia-500 text-white font-bold text-sm px-6 py-2 rounded-md shadow tracking-wide uppercase">
                        CF-METADATA-SYS
                    </div>
                </div>

                {/* Right-side logout */}
                <div className="w-1/3 flex justify-end">
                    <button
                        onClick={() => {
                            document.cookie = "session_visible=; Max-Age=0; Path=/";
                            window.location.href = "/";
                        }}
                        className="bg-gradient-to-tr from-pink-500 to-orange-400 text-white font-medium text-sm px-4 py-2 rounded-md shadow hover:opacity-90 transition"
                    >
                        Log out
                    </button>
                </div>
            </header>





            <div className="flex flex-col items-center gap-6 mt-24">
                <p className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-transparent bg-clip-text animate-fade-in">
                    Welcome
                </p>

                {orgs && orgs.length > 0 ? <>
                    <Select
                        data-testid="org-select"
                        label="Select your organization"
                        className="w-64"
                        selectedKeys={selectedOrg ? [selectedOrg] : []}
                        onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as string;
                            setSelectedOrg(selected);
                        }}
                    >
                        {orgs.map((org) => (
                            <SelectItem key={org}  data-testid={`org-option-${org}`} >
                                {org}
                            </SelectItem>
                        ))}
                    </Select>

                </> : <Button
                    data-testid="login-button"
                    className="bg-gradient-to-tr from-blue-600 to-purple-600 text-white font-medium shadow-md px-6 py-3 rounded-lg min-w-[140px] hover:scale-105 transition-transform"
                    onPress={handleLogin}
                >
                    Log In
                </Button>}
            </div>
        </main>
    );
}
