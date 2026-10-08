// The seven demo sign-ins shown on the login screen and in the Demo panel.
// These are the same phone numbers the seed data uses (§11).
export interface DemoUser {
  phone: string;
  name: string;
  subtitle: string;
}

export const DEMO_USERS: DemoUser[] = [
  { phone: '9845000001', name: 'Arjun Rao', subtitle: 'Owner · CEO' },
  { phone: '9845000002', name: 'Meera Iyer', subtitle: 'Admin · Operations' },
  { phone: '9845000003', name: 'Amit Kulkarni', subtitle: 'Project Manager' },
  { phone: '9845000004', name: 'Kavya Shetty', subtitle: 'Designer' },
  { phone: '9845000005', name: 'Rohan Desai', subtitle: 'QS' },
  { phone: '9845000006', name: 'Suresh Gowda', subtitle: 'Supervisor' },
  { phone: '9845000007', name: 'Ravi Kumar', subtitle: 'Worker' },
];
