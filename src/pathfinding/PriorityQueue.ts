/** Stable binary min-heap: ties retain insertion order for reproducible A*. */
export class PriorityQueue<T> {
  private heap: { value: T; priority: number; order: number }[] = [];
  private sequence = 0;
  get size() {
    return this.heap.length;
  }
  private less(a: number, b: number) {
    const x = this.heap[a],
      y = this.heap[b];
    return (
      x.priority < y.priority ||
      (x.priority === y.priority && x.order < y.order)
    );
  }
  push(value: T, priority: number) {
    this.heap.push({ value, priority, order: this.sequence++ });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    if (!this.heap.length) return undefined;
    const result = this.heap[0].value,
      last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      let i = 0;
      while (true) {
        let next = i,
          l = 2 * i + 1,
          r = l + 1;
        if (l < this.heap.length && this.less(l, next)) next = l;
        if (r < this.heap.length && this.less(r, next)) next = r;
        if (next === i) break;
        [this.heap[i], this.heap[next]] = [this.heap[next], this.heap[i]];
        i = next;
      }
    }
    return result;
  }
}
