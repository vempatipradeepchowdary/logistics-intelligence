/** Consistent success envelope: { success: true, data, meta }. */
export function sendOk(res, data, meta = {}, status = 200) {
  return res.status(status).json({ success: true, data, meta });
}

/** Consistent error envelope: { success: false, error: { code, message, details } }. */
export function sendError(res, status, code, message, details = []) {
  return res.status(status).json({ success: false, error: { code, message, details } });
}
