type StatePredicate<State> = (value: unknown) => value is State;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function commandStateFromResult<State>(
  result: unknown,
  isState: StatePredicate<State>
): State | null {
  const commandState = isRecord(result) ? result.state : undefined;
  if (isState(commandState)) return commandState;
  return isState(result) ? result : null;
}

export function applySequencedState<State>({
  state,
  sendSeq,
  appliedSeq,
  applyState,
}: {
  state: State | null | undefined;
  sendSeq: number;
  appliedSeq: number;
  applyState: (state: State) => void;
}) {
  if (!state || sendSeq < appliedSeq) {
    return { applied: false, appliedSeq };
  }
  applyState(state);
  return { applied: true, appliedSeq: sendSeq };
}
