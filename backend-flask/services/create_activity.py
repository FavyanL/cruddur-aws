from datetime import datetime, timedelta, timezone
from lib.db import pool

class CreateActivity:
  def run(message, user_handle, ttl):
    model = {
      'errors': None,
      'data': None
    }

    now = datetime.now(timezone.utc).astimezone()

    if (ttl == '30-days'):
      ttl_offset = timedelta(days=30)
    elif (ttl == '7-days'):
      ttl_offset = timedelta(days=7)
    elif (ttl == '3-days'):
      ttl_offset = timedelta(days=3)
    elif (ttl == '1-day'):
      ttl_offset = timedelta(days=1)
    elif (ttl == '12-hours'):
      ttl_offset = timedelta(hours=12)
    elif (ttl == '3-hours'):
      ttl_offset = timedelta(hours=3)
    elif (ttl == '1-hour'):
      ttl_offset = timedelta(hours=1)
    else:
      model['errors'] = ['ttl_blank']

    if user_handle == None or len(user_handle) < 1:
      model['errors'] = ['user_handle_blank']

    if message == None or len(message) < 1:
      model['errors'] = ['message_blank']
    elif len(message) > 280:
      model['errors'] = ['message_exceed_max_chars']

    if model['errors']:
      model['data'] = {
        'handle':  user_handle,
        'message': message
      }
    else:
      expires_at = now + ttl_offset
      activity_uuid = CreateActivity.create_activity(user_handle, message, expires_at)
      model['data'] = CreateActivity.query_activity(activity_uuid)
    return model

  # Insert a new activity row, linked to the user matching the given handle.
  # Returns the new activity's UUID.
  def create_activity(handle, message, expires_at):
    sql = """
      INSERT INTO public.activities (
        user_uuid,
        message,
        expires_at
      )
      VALUES (
        (SELECT uuid FROM public.users WHERE users.handle = %(handle)s LIMIT 1),
        %(message)s,
        %(expires_at)s
      )
      RETURNING uuid;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {
          'handle': handle,
          'message': message,
          'expires_at': expires_at,
        })
        return cur.fetchone()[0]

  # Look up a single activity (joined with the user's display info)
  # so the frontend has a complete record to render after posting.
  def query_activity(activity_uuid):
    sql = """
      SELECT
        activities.uuid,
        users.display_name,
        users.handle,
        activities.message,
        activities.created_at,
        activities.expires_at
      FROM public.activities
      INNER JOIN public.users ON activities.user_uuid = users.uuid
      WHERE activities.uuid = %(uuid)s;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'uuid': activity_uuid})
        row = cur.fetchone()
        if row is None:
          return None
        return {
          'uuid': str(row[0]),
          'display_name': row[1],
          'handle': row[2],
          'message': row[3],
          'created_at': row[4].isoformat() if row[4] else None,
          'expires_at': row[5].isoformat() if row[5] else None,
        }