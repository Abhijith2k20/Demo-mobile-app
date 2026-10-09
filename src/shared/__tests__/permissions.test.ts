import { can, canPost, defaultChannelNames, PROJECT_PERMISSIONS } from '../permissions';
import { normalizeChannelName } from '../schemas';

const owner = { companyRole: 'owner' as const };
const admin = { companyRole: 'admin' as const };
const member = { companyRole: 'member' as const };

describe('can', () => {
  it('lets the owner and admins do every project action, on any project', () => {
    for (const action of PROJECT_PERMISSIONS.manager) {
      expect(can(owner, action, { projectRole: null })).toBe(true);
      expect(can(admin, action, { projectRole: null })).toBe(true);
    }
  });

  it('gives a project manager the manager actions', () => {
    expect(can(member, 'task.edit_any', { projectRole: 'manager' })).toBe(true);
    expect(can(member, 'project.members', { projectRole: 'manager' })).toBe(true);
    expect(can(member, 'channel.manage', { projectRole: 'manager' })).toBe(true);
  });

  it('keeps a project member to creating tasks and updating their own', () => {
    expect(can(member, 'task.create', { projectRole: 'member' })).toBe(true);
    expect(can(member, 'task.update_own', { projectRole: 'member' })).toBe(true);
    expect(can(member, 'task.edit_any', { projectRole: 'member' })).toBe(false);
    expect(can(member, 'task.baseline', { projectRole: 'member' })).toBe(false);
    expect(can(member, 'project.members', { projectRole: 'member' })).toBe(false);
  });

  it('gives nothing to someone who is not on the project', () => {
    expect(can(member, 'task.create', { projectRole: null })).toBe(false);
    expect(can(member, 'task.create', {})).toBe(false);
  });

  it('refuses actions it has never heard of', () => {
    expect(can(member, 'project.delete', { projectRole: 'manager' })).toBe(false);
  });
});

describe('canPost', () => {
  it('only lets the owner and admins post in an announcements-style channel', () => {
    const channel = { postingPolicy: 'admins' as const, kind: 'company' as const };
    expect(canPost(owner, channel)).toBe(true);
    expect(canPost(admin, channel)).toBe(true);
    expect(canPost(member, channel)).toBe(false);
  });

  it('lets everyone post in an ordinary channel', () => {
    expect(canPost(member, { postingPolicy: 'everyone', kind: 'project' })).toBe(true);
  });
});

describe('defaultChannelNames', () => {
  it('puts managers in every standard channel', () => {
    expect(defaultChannelNames('manager', 'Supervisor').sort()).toEqual(['design', 'general', 'qs', 'site-work']);
  });

  it('follows the job title for members', () => {
    expect(defaultChannelNames('member', 'Designer')).toEqual(['design', 'general']);
    expect(defaultChannelNames('member', 'QS')).toEqual(['qs', 'general']);
    expect(defaultChannelNames('member', 'Worker')).toEqual(['site-work', 'general']);
    expect(defaultChannelNames('member', 'Supervisor')).toEqual(['site-work', 'general']);
  });
});

describe('normalizeChannelName', () => {
  it('turns what people type into a channel name', () => {
    expect(normalizeChannelName('  Vendor Payments ')).toBe('vendor-payments');
    expect(normalizeChannelName('#Site_Work')).toBe('site-work');
    expect(normalizeChannelName('Q&A!!')).toBe('qa');
    expect(normalizeChannelName('--a--b--')).toBe('a-b');
  });
});
