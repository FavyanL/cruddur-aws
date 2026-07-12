import os
import psycopg2

# Cognito Post Confirmation trigger.
#
# Fires the moment a user confirms their email (or an admin confirms them), and creates
# their row in our users table. Cognito owns the account; this gives them a profile.
#
# ---------------------------------------------------------------------------------------
# STATUS: NOT CURRENTLY ATTACHED TO THE USER POOL. Do not re-attach it until BOTH of the
# following are true, or sign-up will break for everyone.
#
#   1. psycopg2 must be packaged for the Lambda runtime.
#      psycopg2 is a C extension — `psycopg2._psycopg` is a compiled binary. A copy built
#      on macOS will NOT load on Lambda's Amazon Linux, and you get:
#         Unable to import module 'lambda_function': No module named 'psycopg2._psycopg'
#      Use `aws-psycopg2`, or attach a prebuilt psycopg2 Lambda layer.
#
#   2. The database must be reachable FROM AWS.
#      A Lambda cannot open a socket to Postgres running in Docker on a laptop — there is
#      no route into your machine. This only works once the DB lives in RDS, and the Lambda
#      is in the same VPC with a security group that allows it.
#
# WHY THIS MATTERS SO MUCH: if this trigger raises, Cognito FAILS THE CONFIRMATION. A
# broken trigger doesn't degrade sign-up quietly — it blocks it entirely. That is exactly
# what happened here: the import error above made every confirmSignUp() call fail, and the
# cause was invisible from the frontend.
#
# Until then, the same row is created by POST /api/users/provision in app.py, which reads
# the same claims from a verified Cognito ID token. Two paths, one row, same rules.
# ---------------------------------------------------------------------------------------

def lambda_handler(event, context):
    user = event['request']['userAttributes']
    print('userAttributes:', user)

    user_display_name = user.get('name')
    user_email        = user.get('email')
    user_cognito_id   = user.get('sub')

    # The handle: prefer the preferred_username attribute, fall back to the Cognito
    # username. This pool has email as an *alias*, which means the username cannot be an
    # email — so people sign up with their handle AS the username, and preferred_username
    # is never set. Without this fallback the INSERT would write a NULL handle.
    user_handle = user.get('preferred_username') or event.get('userName')

    # Initialise to None BEFORE the try block.
    #
    # These used to be assigned inside the try. If psycopg2.connect() threw — which it
    # always would against an unreachable database — `conn` was never bound, and then the
    # `finally` below hit `if conn:` and raised NameError: name 'conn' is not defined.
    # That turned a handled connection error into an unhandled crash, which failed the
    # trigger, which failed the confirmation. A cleanup block must never assume the thing
    # it's cleaning up got created.
    conn = None
    cur = None

    try:
        conn = psycopg2.connect(os.getenv('CONNECTION_URL'))
        cur = conn.cursor()

        # Parameterised query — never interpolate user-supplied values into SQL.
        # Everything here comes from Cognito, but the discipline is the same regardless.
        #
        # WHERE NOT EXISTS makes this idempotent: if the row is somehow already there
        # (e.g. the backend's /api/users/provision beat us to it), we don't duplicate it.
        sql = """
            INSERT INTO public.users (display_name, email, handle, cognito_user_id)
            SELECT %s, %s, %s, %s
            WHERE NOT EXISTS (
                SELECT 1 FROM public.users WHERE cognito_user_id = %s
            );
        """
        cur.execute(sql, (
            user_display_name,
            user_email,
            user_handle,
            user_cognito_id,
            user_cognito_id,
        ))
        conn.commit()
        print('Provisioned user:', user_handle)

    except (Exception, psycopg2.DatabaseError) as error:
        # Swallowing this is a deliberate choice: raising here would fail the Cognito
        # confirmation and lock the user out of an account they just legitimately created.
        # Better to let them in and repair the missing row than to block sign-up.
        # (CloudWatch keeps the message so the failure is still visible to us.)
        print("Database error:", error)

    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()
            print('Database connection closed.')

    # Cognito requires the event to be returned unmodified.
    return event
