from lib.db import pool

class ProvisionUser:
  # Create this Cognito user's row in our users table, if it doesn't exist yet.
  #
  # WHY THIS EXISTS
  # Cognito owns the *account* (email, password, verification). Our database owns the
  # *profile* (handle, display name, and the uuid that every crud and message is
  # foreign-keyed to). Something has to bridge the two the first time a new person
  # signs in, or /api/users/me returns 404 forever and they can never enter the app.
  #
  # In the deployed version of this project that bridge is a Cognito Post Confirmation
  # Lambda trigger (see aws/json/lambdas/cruddur-post-confirmation.py) which INSERTs the
  # same row from the same claims. That Lambda cannot run against a Postgres container
  # on a laptop — there is no network route from AWS into your machine — so locally we
  # do the same INSERT here, on first sign-in, instead.
  #
  # SECURITY
  # The claims passed in come from a token whose signature has already been verified
  # against Cognito's public keys. The browser cannot invent a handle or an email:
  # if it tampers with a single byte, verification fails upstream and we never get here.
  #
  # IDEMPOTENCY
  # This runs on every sign-in where no row is found, so it must be safe to call twice
  # (two tabs opening at once, a double-click, a retry). The INSERT ... WHERE NOT EXISTS
  # makes the check and the write a single atomic statement, so a race can't produce two
  # rows for the same person.
  def run(cognito_user_id, email, handle, display_name):
    sql = """
      INSERT INTO public.users (display_name, email, handle, cognito_user_id)
      SELECT %(display_name)s, %(email)s, %(handle)s, %(cognito_user_id)s
      WHERE NOT EXISTS (
        SELECT 1 FROM public.users WHERE cognito_user_id = %(cognito_user_id)s
      );
    """

    # Whatever happens above, read the row back out. If we just inserted it we get the
    # new row; if it already existed (the race case) we get the existing one. Either way
    # the caller receives the user, never None.
    select_sql = """
      SELECT users.uuid, users.display_name, users.handle
      FROM public.users
      WHERE users.cognito_user_id = %(cognito_user_id)s
      LIMIT 1;
    """

    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {
          'display_name': display_name,
          'email': email,
          'handle': handle,
          'cognito_user_id': cognito_user_id,
        })
        cur.execute(select_sql, {'cognito_user_id': cognito_user_id})
        row = cur.fetchone()
        conn.commit()

        if row is None:
          return None
        return {
          'uuid': str(row[0]),
          'display_name': row[1],
          'handle': row[2],
        }
