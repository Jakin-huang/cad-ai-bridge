// Keep details in the error message as well as the code: both CLI and MCP
// transports already preserve this field, including deferred tool results.
export function documentError(code, details) {
 return new Error(code + ': ' + JSON.stringify(details));
}
