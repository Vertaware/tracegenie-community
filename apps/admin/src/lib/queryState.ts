import { classifyQueryAsyncState,type QueryAsyncState } from "@tracegenie/shared";

type QueryStateSource<T> = {
  data?: T;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
};

export function classifyAdminQueryState<T>(
  query: QueryStateSource<T>,
  isEmpty: (data: T) => boolean,
  enabled = true,
): QueryAsyncState<T> {
  return classifyQueryAsyncState(
    {
      enabled,
      data: query.data,
      isPending: query.isPending,
      isFetching: query.isFetching,
      isError: query.isError,
    },
    isEmpty,
  );
}
