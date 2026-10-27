// Read-only Socket.IO transport authentication. Keep the access token out of
// URLs and JavaScript-readable cookies; transactional APIs still use Bearer JWT.
export const SOCKET_ACCESS_COOKIE = 'grabit_socket_access';
export const SOCKET_ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/socket.io/',
};
