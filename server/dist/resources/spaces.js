export function setupSpaceResources(server, client) {
    // Spaces resource
    server.registerResource("spaces", "capacities://spaces", {
        name: "Capacities Spaces",
        description: "List of all your Capacities spaces",
        mimeType: "application/json"
    }, async () => {
        try {
            const spaces = await client.getSpaces();
            return {
                contents: [{
                        uri: "capacities://spaces",
                        text: JSON.stringify(spaces, null, 2)
                    }]
            };
        }
        catch (error) {
            throw new Error(`Failed to fetch spaces: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
}
//# sourceMappingURL=spaces.js.map