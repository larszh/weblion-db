import type { WebspaceDetailDto } from '@weblion/shared';
import { Placeholder } from '@/components/placeholder';

/** One website (/o/:slug/webhosting/:webspaceId, kind "website"). Placeholder until the page is built. */
export function WebsiteView({ website }: { website: WebspaceDetailDto }) {
  return <Placeholder title={website.name} />;
}
