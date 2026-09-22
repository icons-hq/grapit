import { PerformancePreparationWorkspace } from '@/components/admin/performance-preparation-workspace';

export default async function AdminPerformancePreparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PerformancePreparationWorkspace id={id} />;
}
