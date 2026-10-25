import { redirect } from 'next/navigation'

// New leads are added from the board's drawer; keep old links working.
export default function NewLeadPage() {
  redirect('/leads?new=1')
}
