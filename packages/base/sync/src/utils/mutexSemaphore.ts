class SelfAwarePromise<T> {
  private readonly promise: Promise<T>

  private isResolved: boolean = false

  private isRejected: boolean = false

  public constructor(
    promiseArgument:
      | ((
        resolve: (value: T) => void,
        reject: (reason?: unknown) => void,
      ) => Promise<void>)
      | ((
        resolve: (value: T) => void,
        reject: (reason?: unknown) => void,
      ) => void),
  ) {
    this.promise = new Promise((resolve, reject) => {
      const selfAwareResolve = (value: T): void => {
        this.isResolved = true
        resolve(value)
      }
      const selfAwareReject = (reason?: unknown): void => {
        this.isRejected = true
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(reason)
      }
      void promiseArgument(selfAwareResolve, selfAwareReject)
    })
  }

  public async getPromise(): Promise<T> {
    return await this.promise
  }

  public getIsRejected(): boolean {
    return this.isRejected
  }

  public getIsResolved(): boolean {
    return this.isResolved
  }

  public getIsPending(): boolean {
    return !this.getIsRejected() && !this.getIsResolved()
  }
}

class MutexSemaphore {
  private nextExecutionIdentifier: number = 0

  private mutexReleased: SelfAwarePromise<number>
    = new SelfAwarePromise<number>((resolve) => {
      // Resolve the promise with the first identifier
      resolve(this.nextExecutionIdentifier)
    })

  private rejectMutex: (() => void) | null = null

  public isLocked(): boolean {
    return this.mutexReleased.getIsPending()
  }

  public async lock(): Promise<() => void> {
    const myIdentifier = this.nextExecutionIdentifier
    const nextIdentifier = myIdentifier + 1
    this.nextExecutionIdentifier = nextIdentifier

    // Initialize the allowedIdentifier to a value that will not match myIdentifier
    let allowedIdentifier = myIdentifier - 1

    // Wait until it's our turn
    while (allowedIdentifier !== myIdentifier) {
      // It's not our turn, wait for the next number

      allowedIdentifier = await this.mutexReleased.getPromise()
    }

    let resolveFunction = (): void => {}
    this.mutexReleased = new SelfAwarePromise((resolve, reject) => {
      // Store the reject function so we can call it in the destructor
      this.rejectMutex = reject
      resolveFunction = () => {
        // Invalidate the reject function
        this.rejectMutex = null

        // Release the mutex
        resolve(nextIdentifier)
      }
    })
    return resolveFunction
  }

  public async doWithMutex<T_return>(
    callback: () => Promise<T_return>,
  ): Promise<T_return> {
    const mutexRelease = await this.lock()
    try {
      return await callback()
    } finally {
      mutexRelease()
    }
  }

  public destructor(): void {
    const lockPromise = this.lock()
    this.rejectMutex?.()

    // Ignore the rejection of the lock promise
    lockPromise.catch(() => {})
  }
}

export default MutexSemaphore
