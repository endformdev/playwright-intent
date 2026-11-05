# Open questions

Decisions we have deliberately postponed.

## Should the model see variable values?

`ai.do('sign up as {email}', { email })` sends the model the intent and the variable names, not the values. Generated code reads `vars.email`. The model also gets the unfiltered test file, so a value written directly in the test does reach it.

Hiding runtime values is the simplest safe default, and Stagehand makes the same choice. It may not be enough when the model has to recognise a value on the page. In `add {product} to the cart`, it can write `getByRole('button', { name: vars.product })`, but if the value comes from outside the test file, it can't tell which item in a snapshot is the right one.

Options to weigh later:

- Keep values hidden.
- Let the model invent its own sample values while exploring.
- Mark variables as secret or public, and only send public values.

## How do we keep secrets out of page observations?

Values can still reach the model through a page snapshot or screenshot after they've been typed. Snapshot text can be scrubbed by replacing known values. Screenshots are harder, so we need an approach before claiming that values never reach the model.
