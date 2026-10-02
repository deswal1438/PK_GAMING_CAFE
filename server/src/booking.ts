export function minutes(time: string): number {
  const parts = time.split(":").map(Number);
  const hours = parts[0] ?? 0;
  const mins = parts[1] ?? 0;
  return (hours * 60) + mins;
}

export function overlaps(candidateStart: string, candidateEnd: string, existingStart: string, existingEnd: string): boolean {
  return minutes(candidateStart) < minutes(existingEnd) && minutes(existingStart) < minutes(candidateEnd);
}

export function calculateEndTime(startTime: string, duration: number): string {
  const end = minutes(startTime) + duration;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
