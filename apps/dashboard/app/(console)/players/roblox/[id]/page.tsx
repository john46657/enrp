'use client';

import { use } from 'react';
import { ProfileView } from '../../profile-view';

export default function RobloxProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProfileView path={`/players/roblox/${encodeURIComponent(id)}`} />;
}
