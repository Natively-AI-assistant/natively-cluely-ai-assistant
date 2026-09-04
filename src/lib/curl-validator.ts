import curl2Json from "@bany/curl-to-json";
import {
    TEXT_PLACEHOLDER_RE,
    placeholderReachesTheWire,
    explainMissingPlaceholder,
} from './curlPlaceholderPolicy';

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    // Basic check for curl command
    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return {
            isValid: false,
            message: "The command must start with 'curl'.",
        };
    }

    try {
        const json = curl2Json(curl);

        // Check for {{TEXT}} placeholder. Spacing tolerated, matching
        // deepVariableReplacer, which substitutes `{{ TEXT }}` as readily as
        // `{{TEXT}}` — telling the user a template is invalid when the engine
        // handles it fine is the wrong half of that pair to keep strict.
        if (!TEXT_PLACEHOLDER_RE.test(curl)) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} variable to inject the user message."
            };
        }

        // The same rules the main process applies, from the same module — this
        // block used to be a verbatim copy of curlUtils', message strings and
        // all, which is exactly how the two drifted.
        if (!placeholderReachesTheWire(json)) {
            return { isValid: false, message: explainMissingPlaceholder(json) };
        }

        return { isValid: true, json };
    } catch (error) {
        return {
            isValid: false,
            message:
                "Invalid cURL command syntax. Please check for typos.",
        };
    }
};
