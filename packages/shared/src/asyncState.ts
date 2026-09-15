export type QueryAsyncStateKind =
  | "idle"
  | "loading"
  | "refreshing"
  | "success-empty"
  | "success-data"
  | "stale"
  | "error";

export type QueryAsyncInput<T> = {
  enabled: boolean;
  data?: T;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
};

export type QueryAsyncState<T> = {
  kind: QueryAsyncStateKind;
  data?: T;
};

export function classifyQueryAsyncState<T>(
  input: QueryAsyncInput<T>,
  isEmpty: (data: T) => boolean,
): QueryAsyncState<T> {
  if (!input.enabled || (input.isPending && !input.isFetching)) {
    return { kind: "idle" };
  }
  if (input.isError) {
    return input.data === undefined
      ? { kind: "error" }
      : { kind: "stale", data: input.data };
  }
  if (input.isPending || input.data === undefined) {
    return { kind: "loading" };
  }
  if (input.isFetching) {
    return { kind: "refreshing", data: input.data };
  }
  return isEmpty(input.data)
    ? { kind: "success-empty", data: input.data }
    : { kind: "success-data", data: input.data };
}

export type MutationAsyncStateKind = "idle" | "pending" | "retry" | "success" | "error";

export type MutationAsyncInput = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  failureCount?: number;
};

export type MutationAsyncState = {
  kind: MutationAsyncStateKind;
  canRetry: boolean;
};

export function classifyMutationAsyncState(input: MutationAsyncInput): MutationAsyncState {
  if (input.isPending) {
    return {
      kind: (input.failureCount ?? 0) > 0 ? "retry" : "pending",
      canRetry: false,
    };
  }
  if (input.isError) {
    return { kind: "error", canRetry: true };
  }
  if (input.isSuccess) {
    return { kind: "success", canRetry: false };
  }
  return { kind: "idle", canRetry: false };
}
