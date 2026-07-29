with open('frontend/utils/types.ts', 'a') as f:
    f.write('
export interface BulkActionResponse {
')
    f.write('  success: boolean;
')
    f.write('  message?: string;
')
    f.write('  processedCount: number;
')
    f.write('  failedCount: number;
')
    f.write('}
')
