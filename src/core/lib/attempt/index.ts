/** Utility type for functions that can be sync or async. */
type Awaitable<T> = T | Promise<T>;

/** Handlers for exhaustive matching on a Result. */
interface MatchHandlers<T, E, U> {
	/** Handler for the success case. */
	ok: (data: T) => U;
	/** Handler for the failure case. */
	err: (error: E) => U;
}

/**
 * Success variant of a Result. Holds the resolved data.
 */
export class Ok<T> {
	/** The resolved data. */
	public readonly data: T;

	public constructor(data: T) {
		this.data = data;
	}

	/** Type guard: returns true, narrowing to Ok. */
	public isOk(): this is Ok<T> {
		return true;
	}

	/** Type guard: returns false, narrowing out Err. */
	public isErr(): this is Err<never> {
		return false;
	}

	/** Transforms the success data. */
	public map<U>(fn: (data: T) => U): Result<U, never> {
		return new Ok(fn(this.data));
	}

	/** No-op on Ok — returns this unchanged. */
	public mapErr(_fn: (error: never) => unknown): this {
		return this;
	}

	/** Returns the data. */
	public unwrap(): T {
		return this.data;
	}

	/** Returns the data, ignoring the default. */
	public unwrapOr(_defaultValue: T): T {
		return this.data;
	}

	/** Returns the data, ignoring the fallback function. */
	public unwrapOrElse(_fn: (error: never) => T): T {
		return this.data;
	}

	/** Calls the ok handler with the data. */
	public match<U>(handlers: MatchHandlers<T, never, U>): U {
		return handlers.ok(this.data);
	}
}

/**
 * Failure variant of a Result. Holds the error.
 */
export class Err<E> {
	/** The error value. */
	public readonly error: E;

	public constructor(error: E) {
		this.error = error;
	}

	/** Type guard: returns false, narrowing out Ok. */
	public isOk(): this is Ok<never> {
		return false;
	}

	/** Type guard: returns true, narrowing to Err. */
	public isErr(): this is Err<E> {
		return true;
	}

	/** No-op on Err — returns this unchanged. */
	public map(_fn: (data: never) => unknown): this {
		return this;
	}

	/** Transforms the error value. */
	public mapErr<F>(fn: (error: E) => F): Result<never, F> {
		return new Err(fn(this.error));
	}

	/**
	 * Throws the error. Always returns never.
	 *
	 * @remarks When `E` is not an `Error` instance, the raw value is thrown.
	 * Callers should use `unwrapOr` or `match` if the error type may not be an Error.
	 */
	public unwrap(): never {
		throw this.error;
	}

	/** Returns the default value. */
	public unwrapOr<T>(defaultValue: T): T {
		return defaultValue;
	}

	/** Computes a fallback value from the error. */
	public unwrapOrElse<T>(fn: (error: E) => T): T {
		return fn(this.error);
	}

	/** Calls the err handler with the error. */
	public match<U>(handlers: MatchHandlers<never, E, U>): U {
		return handlers.err(this.error);
	}
}

/**
 * Discriminated union representing either success ({@link Ok}) or failure ({@link Err}).
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Creates an Ok result holding the given value. */
export function ok<T>(value: T): Ok<T> {
	return new Ok(value);
}

/** Creates an Err result holding the given error. */
export function err<E>(error: E): Err<E> {
	return new Err(error);
}

/**
 * Executes a function (sync or async) and returns a Result.
 *
 * Built on Promise.try, this provides unified error handling for
 * both synchronous and asynchronous operations.
 *
 * @param fn - Function to execute (can be sync or async)
 * @returns Promise resolving to Result<T, Error>
 */
export function attempt<T>(fn: () => Awaitable<T>): Promise<Result<T, Error>> {
	return Promise.try(fn)
		.then((data) => ok(data))
		.catch((thrown): Err<Error> => {
			if (thrown instanceof Error) {
				return err(thrown);
			}

			let detail: string;
			try {
				detail =
					typeof thrown === 'object' && thrown !== null
						? JSON.stringify(thrown)
						: String(thrown);
			} catch {
				detail = String(thrown);
			}

			const error = new Error(`Attempt error: ${detail}`, {
				cause: thrown,
			});

			return err(error);
		});
}

/**
 * Standalone type guard for Ok results. Useful as an array filter predicate.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
	return result.isOk();
}

/**
 * Standalone type guard for Err results. Useful as an array filter predicate.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
	return result.isErr();
}
