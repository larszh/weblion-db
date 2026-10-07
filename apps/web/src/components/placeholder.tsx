import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';

/** Temporary stand-in while a page is being built. */
export function Placeholder({ title }: { title: string }) {
  return <EmptyState icon={<Construction className="size-6" />} title={title} description="…" />;
}
