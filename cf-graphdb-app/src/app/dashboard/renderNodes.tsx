import { useEffect, useState } from "react";

type Node = {
    id: string;
    type: string;
    properties: Record<string, string | number>;
};

export const RenderNodes = ({ org }: { org: string }) => {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchNodes() {
            setLoading(true);
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_OIDC_WORKER_BASE}/${org}/nodes`, {
                    credentials: "include",
                });

                if (!res.ok) { // noinspection ExceptionCaughtLocallyJS
                    throw new Error("Failed to fetch nodes");
                }

                const data:any = await res.json();
                setNodes(data.nodes || []);
            } catch (err) {
                console.error("Failed to fetch nodes:", err);
                setNodes([]);
            } finally {
                setLoading(false);
            }
        }
        fetchNodes();
    }, [org]);

    if (loading) {
        return <div className="text-center mt-6 text-gray-500">Loading nodes...</div>;
    }

    if (nodes.length === 0) {
        return <div className="text-center mt-6 text-gray-500">No nodes found.</div>;
    }

    return (
        <div className="px-6 py-4">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">Nodes for {org}</h2>
            <ul className="space-y-4">
                {nodes.map((node) => (
                    <li key={node.id} className="bg-white p-4 rounded-lg shadow">
                        <p className="font-bold text-sm text-indigo-600">Node ID: {node.id}</p>
                        <p className="text-gray-700 text-sm mb-2">Type: {node.type}</p>
                        <div className="text-xs text-gray-500">
                            {Object.entries(node.properties).map(([key, value]) => (
                                <div key={key}>
                                    <span className="font-medium" data-testid={value}>{key}</span>: {String(value)}
                                </div>
                            ))}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};
