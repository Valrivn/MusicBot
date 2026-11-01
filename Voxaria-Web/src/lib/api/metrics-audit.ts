import { request } from './auth-client';
import type { ApiAuditTrack } from './auth-client';

export const metricsAuditApi = {
  getAuditLog: () => request<ApiAuditTrack[]>("/api/audit"),
};
