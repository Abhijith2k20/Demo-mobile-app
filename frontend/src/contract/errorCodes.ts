// The error shape every API reply uses. The list of codes lives on the server (backend/app/core.py).
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: { fields?: Record<string, string> } & Record<string, unknown>;
    request_id: string;
  };
}
