"use client";

import { useSearchParams } from "next/navigation";
import { RenderNodes } from "@/app/dashboard/renderNodes";

export default function Dashboard() {
    const searchParams = useSearchParams();
    const selectedOrg = searchParams.get("org");

    return (
        <main className="min-h-screen flex flex-col bg-gray-50">
            <div className="relative flex items-center justify-between px-6 py-4 bg-white shadow-md">
                <div className="flex items-center gap-4" />

                <div className="absolute left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-tr from-cyan-600 via-sky-500 to-emerald-400 text-white font-bold text-sm px-4 py-2 rounded-full shadow-md tracking-wide uppercase">
                        {selectedOrg}
                    </div>
                </div>


                <button
                    onClick={() => {
                        document.cookie = "session_visible=; Max-Age=0; Path=/";
                        window.location.href = "/";
                    }}
                    className="bg-gradient-to-tr from-pink-500 to-orange-400 text-white font-medium shadow px-5 py-2 rounded-md hover:opacity-90 transition"
                >
                    Log out
                </button>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center">
                {selectedOrg ? (
                    <RenderNodes org={selectedOrg} />
                ) : (
                    <h1 className="text-2xl font-bold text-gray-800">Select an Org</h1>
                )}
            </div>
        </main>
    );
}
