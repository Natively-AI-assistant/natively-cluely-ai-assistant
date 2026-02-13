import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

/**
 * Validates if the cURL command is parseable and contains required variables
 */
export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return { isValid: false, message: "Command must start with 'curl'." };
    }

    try {
        const json = curl2Json(curl);

        // Ensure {{TEXT}} is present so we can inject the prompt
        // We check the raw string for the placeholder because it might be in url, header, or body
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} placeholder for the prompt."
            };
        }

        return { isValid: true, json };
    } catch (error) {
        return { isValid: false, message: "Invalid cURL syntax." };
    }
};

/**
 * Replaces {{KEY}} placeholders with actual values
 */
export function deepVariableReplacer(
    node: any,
    variables: Record<string, string>
): any {
    if (typeof node === "string") {
        let result = node;
        for (const [key, value] of Object.entries(variables)) {
            // Global replace of {{KEY}}
            result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
        }
        return result;
    }
    if (Array.isArray(node)) {
        return node.map((item) => deepVariableReplacer(item, variables));
    }
    if (node && typeof node === "object") {
        const newNode: { [key: string]: any } = {};
        for (const key in node) {
            newNode[key] = deepVariableReplacer(node[key], variables);
        }
        return newNode;
    }
    return node;
}

/**
 * Helper to traverse a JSON object via dot notation (e.g. "choices[0].message.content")
 */
export function getByPath(obj: any, path: string): any {
    if (!path) return obj;
    return path
        .replace(/\[/g, ".")
        .replace(/\]/g, "")
        .split(".")
        .reduce((o, k) => (o || {})[k], obj);
}
