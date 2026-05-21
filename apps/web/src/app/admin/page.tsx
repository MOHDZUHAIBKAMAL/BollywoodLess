import { AdminTracks } from '@/components/AdminTracks';
import { notFound } from 'next/navigation';

export default function AdminPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return <AdminTracks />;
}
