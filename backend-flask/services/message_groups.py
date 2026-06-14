from lib.db import pool, query_wrap_array

class MessageGroups:
  def run(user_handle):
    model = {
      'errors': None,
      'data': None
    }

    if user_handle == None or len(user_handle) < 1:
      model['errors'] = ['user_handle_blank']
      return model

    # Find every distinct person this user has messaged with (either direction),
    # plus the time of the most recent message in each conversation.
    sql = query_wrap_array("""
      SELECT
        other_user.uuid,
        other_user.display_name,
        other_user.handle,
        MAX(messages.created_at) AS created_at
      FROM public.messages
      INNER JOIN public.users me ON me.handle = %(handle)s
      INNER JOIN public.users other_user
        ON (other_user.uuid = messages.user_sender_uuid AND messages.user_receiver_uuid = me.uuid)
        OR (other_user.uuid = messages.user_receiver_uuid AND messages.user_sender_uuid = me.uuid)
      WHERE other_user.uuid != me.uuid
      GROUP BY other_user.uuid, other_user.display_name, other_user.handle
      ORDER BY MAX(messages.created_at) DESC
    """)
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'handle': user_handle})
        row = cur.fetchone()
        model['data'] = row[0] if row and row[0] else []
    return model