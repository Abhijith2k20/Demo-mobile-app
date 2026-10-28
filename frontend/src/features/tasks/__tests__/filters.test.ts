import { advancedCount, filterQuery, isFiltering, isPendingOnly, NO_FILTERS, PENDING, type TaskFilters } from '../filters';

const f = (over: Partial<TaskFilters>): TaskFilters => ({ ...NO_FILTERS, ...over });

describe('filterQuery', () => {
  it('sends only the filters that are set', () => {
    expect(filterQuery(NO_FILTERS)).toBe('');
    expect(filterQuery(f({ owner: 'me', statuses: PENDING }))).toBe(
      'status=not_started%2Cin_progress%2Cblocked%2Cdone_pending_confirmation&owner=me',
    );
    expect(filterQuery(f({ due: 'week', delayed: true, phases: ['Venue', 'Sound check'] }))).toBe('due=week&delayed=true&phase=Venue%2CSound+check');
  });
});

describe('filter summaries', () => {
  it('the quick chips are not counted as advanced filters', () => {
    expect(advancedCount(f({ owner: 'me', statuses: PENDING }))).toBe(0);
    expect(isPendingOnly(f({ statuses: PENDING }))).toBe(true);
    expect(isFiltering(f({ owner: 'me' }))).toBe(true);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });

  it('counts each advanced group once', () => {
    expect(advancedCount(f({ statuses: ['blocked'], owner: 'ravi', due: 'week', delayed: true, phases: ['Venue', 'Sound check'] }))).toBe(5);
  });
});
