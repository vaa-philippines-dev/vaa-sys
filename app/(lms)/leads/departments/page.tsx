import { DepartmentsPage } from '@/components/leads/DepartmentsPage'

// Lead Management's Departments & services page (the same page is under
// Company in Customer Management, at /departments).
export default function LeadsDepartmentsPage() {
  return <DepartmentsPage area="lms" path="/leads/departments" />
}
