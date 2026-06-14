from lib.db import pool, query_wrap_array

class UserActivities:
  def run(user_handle):
    model = {
      'errors': None,
      'data': None
    }

    if user_handle == None or len(user_handle) < 1:
      model['errors'] = ['blank_user_handle']
    else:
      sql = query_wrap_array("""
        SELECT
          activities.uuid,
          users.display_name,
          users.handle,
          activities.message,
          activities.created_at,
          activities.expires_at
        FROM public.activities
        INNER JOIN public.users ON activities.user_uuid = users.uuid
        WHERE users.handle = %(handle)s
          AND activities.reply_to_activity_uuid IS NULL
        ORDER BY activities.created_at DESC
      """)
      with pool.connection() as conn:
        with conn.cursor() as cur:
          cur.execute(sql, {'handle': user_handle})
          row = cur.fetchone()
          model['data'] = row[0] if row and row[0] else []
    return model