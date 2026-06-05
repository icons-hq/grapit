import { getClientVisibleCopy } from './i18n/client-copy';

export const STATUS_MESSAGES: Record<number, string> = {
  400: '잘못된 요청입니다.',
  403: '접근 권한이 없습니다.',
  404: '요청하신 정보를 찾을 수 없습니다.',
  408: '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  500: '서버에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
};

export function getStatusMessages(): Record<number, string> {
  const copy = getClientVisibleCopy().commonErrors;

  return {
    400: copy.badRequest,
    403: copy.forbidden,
    404: copy.notFound,
    408: copy.timeout,
    429: copy.tooManyRequests,
    500: copy.server,
  };
}

export function getDefaultErrorMessage() {
  return getClientVisibleCopy().commonErrors.default;
}
