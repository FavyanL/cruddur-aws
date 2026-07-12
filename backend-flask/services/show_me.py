from lib.db import pool

class ShowMe:
  # Given a verified Cognito user id, return that user's own profile row.
  # Returns None if no matching user exists in the database.
  def run(cognito_user_id):
    sql = """
      SELECT
        users.uuid,
        users.display_name,
        users.handle
      FROM public.users
      WHERE users.cognito_user_id = %(cognito_user_id)s
      LIMIT 1;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'cognito_user_id': cognito_user_id})
        row = cur.fetchone()
        if row is None:
          return None
        return {
          'uuid': str(row[0]),
          'display_name': row[1],
          'handle': row[2],
        }
